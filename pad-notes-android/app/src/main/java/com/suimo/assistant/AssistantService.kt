package com.suimo.assistant

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.DisplayMetrics
import android.view.Display
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.suimo.assistant.ai.AiClient
import com.suimo.assistant.ai.AiException
import com.suimo.assistant.ai.Analysis
import com.suimo.assistant.ai.DemoDeck
import com.suimo.assistant.ai.Suggestion
import com.suimo.assistant.ai.SuggestionType
import com.suimo.assistant.data.Settings
import com.suimo.assistant.data.SettingsStore
import com.suimo.assistant.overlay.OverlayController
import com.suimo.assistant.util.ImageTools
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.roundToInt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

/**
 * Owns MediaProjection, the virtual display / ImageReader pair, the floating
 * overlay and the AI request lifecycle. It is a foreground service of type
 * `mediaProjection` so Android 14+ keeps the projection alive while the user
 * writes in another app.
 */
class AssistantService : Service() {

    companion object {
        const val ACTION_START = "com.suimo.assistant.action.START"
        const val ACTION_STOP = "com.suimo.assistant.action.STOP"
        const val EXTRA_RESULT_CODE = "extra_result_code"
        const val EXTRA_RESULT_DATA = "extra_result_data"

        private const val CHANNEL_ID = "suimo_overlay"
        private const val NOTIFICATION_ID = 0x5701
        private const val FRAME_INTERVAL_MS = 1200L
        private const val SNAPSHOT_TIMEOUT_MS = 2600L
        private const val OVERLAY_HIDE_SETTLE_MS = 1500L
        private const val FRESH_FRAME_MARGIN_MS = 500L

        @Volatile
        var isRunning: Boolean = false
            internal set

        fun startIntent(context: Context, resultCode: Int, data: Intent): Intent =
            Intent(context, AssistantService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_RESULT_CODE, resultCode)
                putExtra(EXTRA_RESULT_DATA, data)
            }

        fun stopIntent(context: Context): Intent =
            Intent(context, AssistantService::class.java).apply { action = ACTION_STOP }
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var settingsStore: SettingsStore

    private var overlay: OverlayController? = null
    private var foregroundStarted = false
    private var destroyed = false

    private var projection: MediaProjection? = null
    private var displayManager: DisplayManager? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var frameThread: HandlerThread? = null
    private var frameHandler: Handler? = null
    private var captureSize: Pair<Int, Int>? = null
    private var captureGeneration = 0

    private var latestFrame: Bitmap? = null
    private var latestFrameAt = 0L
    private var lastStoredAt = 0L

    private var pendingSnapshotId: Any? = null
    private var pendingSnapshot: ((Bitmap?) -> Unit)? = null
    private var pendingSnapshotMinTime = 0L
    private var analysisJob: Job? = null
    private var previousTitles = mutableListOf<String>()
    private val demoDeck by lazy { DemoDeck(buildDemoPatterns()) }

    private val displayListener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(displayId: Int) = Unit
        override fun onDisplayRemoved(displayId: Int) = Unit
        override fun onDisplayChanged(displayId: Int) {
            if (displayId != Display.DEFAULT_DISPLAY) return
            mainHandler.post { recreateIfDisplayChanged() }
        }
    }

    override fun onCreate() {
        super.onCreate()
        settingsStore = SettingsStore(this)
        createNotificationChannel()
        overlay = OverlayController(
            context = this,
            callbacks = object : OverlayController.Callbacks {
                override fun onAnalyze() = analyze()

                override fun onCrop() = beginCrop()

                override fun onOpenSettings() {
                    startActivity(
                        Intent(this@AssistantService, MainActivity::class.java)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    )
                }
            },
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }

            ACTION_START -> {
                if (!startForegroundSafely()) {
                    stopSelf()
                    return START_NOT_STICKY
                }
                if (projection == null) {
                    val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
                    val data = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(EXTRA_RESULT_DATA)
                    }
                    if (data == null) {
                        overlay?.toast(getString(R.string.toast_capture_failed))
                        stopSelf()
                        return START_NOT_STICKY
                    }
                    startProjection(resultCode, data)
                }
                if (projection != null) {
                    isRunning = true
                    overlay?.showWelcome()
                }
            }
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        destroyed = true
        isRunning = false
        analysisJob?.cancel()
        serviceScope.cancel()
        overlay?.detachAll()
        runCatching { displayManager?.unregisterDisplayListener(displayListener) }
        runCatching { projection?.stop() }
        projection = null
        releaseVirtualDisplay()
        frameThread?.quitSafely()
        frameThread = null
        frameHandler = null
        latestFrame = null
        if (foregroundStarted) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            foregroundStarted = false
        }
        super.onDestroy()
    }

    private fun startForegroundSafely(): Boolean {
        if (foregroundStarted) return true
        return try {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                buildNotification(),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
            )
            foregroundStarted = true
            true
        } catch (error: Exception) {
            overlay?.toast("无法启动屏幕采集服务：${error.message ?: "未知错误"}")
            false
        }
    }

    private fun startProjection(resultCode: Int, data: Intent) {
        val manager = getSystemService(MediaProjectionManager::class.java)
        val mediaProjection = try {
            manager.getMediaProjection(resultCode, data)
        } catch (error: Exception) {
            null
        }
        if (mediaProjection == null) {
            overlay?.toast(getString(R.string.toast_capture_failed))
            stopSelf()
            return
        }
        projection = mediaProjection
        mediaProjection.registerCallback(
            object : MediaProjection.Callback() {
                override fun onStop() {
                    mainHandler.post { onProjectionStopped() }
                }
            },
            mainHandler,
        )
        displayManager = getSystemService(DisplayManager::class.java)
        displayManager?.registerDisplayListener(displayListener, mainHandler)
        createVirtualDisplay()
    }

    private fun createVirtualDisplay() {
        val mediaProjection = projection ?: return
        val display = displayManager?.getDisplay(Display.DEFAULT_DISPLAY) ?: return
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        display.getRealMetrics(metrics)
        val (width, height) = ImageTools.captureSize(metrics.widthPixels, metrics.heightPixels)
        val density = (metrics.densityDpi * (width.toFloat() / metrics.widthPixels))
            .roundToInt()
            .coerceAtLeast(1)
        releaseVirtualDisplay()
        try {
            val reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 3)
            if (frameThread == null) {
                val newThread = HandlerThread("suimo-frames").also { it.start() }
                frameThread = newThread
                frameHandler = Handler(newThread.looper)
            }
            val generation = ++captureGeneration
            reader.setOnImageAvailableListener(
                { source -> onImageAvailable(source, generation) },
                frameHandler,
            )
            val newDisplay = mediaProjection.createVirtualDisplay(
                "suimo-capture",
                width,
                height,
                density,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                reader.surface,
                null,
                null,
            )
            if (newDisplay == null) {
                reader.close()
                overlay?.showError(getString(R.string.toast_capture_failed))
                return
            }
            imageReader = reader
            virtualDisplay = newDisplay
            captureSize = width to height
            lastStoredAt = 0L
        } catch (error: Exception) {
            overlay?.showError("无法读取屏幕：${error.message ?: "未知错误"}")
        }
    }

    private fun releaseVirtualDisplay() {
        imageReader?.setOnImageAvailableListener(null, null)
        runCatching { virtualDisplay?.release() }
        runCatching { imageReader?.close() }
        virtualDisplay = null
        imageReader = null
        captureSize = null
    }

    private fun recreateIfDisplayChanged() {
        if (destroyed || projection == null) return
        val display = displayManager?.getDisplay(Display.DEFAULT_DISPLAY) ?: return
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        display.getRealMetrics(metrics)
        val target = ImageTools.captureSize(metrics.widthPixels, metrics.heightPixels)
        if (target != captureSize) createVirtualDisplay()
    }

    private fun onImageAvailable(reader: ImageReader, generation: Int) {
        val image = runCatching { reader.acquireLatestImage() }.getOrNull() ?: return
        try {
            val capturedAt = SystemClock.elapsedRealtime()
            val wantImmediately = pendingSnapshot != null
            if (!wantImmediately && capturedAt - lastStoredAt < FRAME_INTERVAL_MS) return
            val bitmap = runCatching { ImageTools.imageToBitmap(image) }.getOrNull() ?: return
            lastStoredAt = capturedAt
            mainHandler.post {
                if (destroyed || generation != captureGeneration) return@post
                latestFrame = bitmap
                latestFrameAt = capturedAt
                val callback = pendingSnapshot
                val id = pendingSnapshotId
                if (callback != null && id != null && latestFrameAt >= pendingSnapshotMinTime) {
                    pendingSnapshot = null
                    pendingSnapshotId = null
                    callback(bitmap)
                }
            }
        } finally {
            image.close()
        }
    }

    /**
     * Resolves with the latest mirror frame. When [minTimestamp] is set, only a
     * frame captured after that moment is accepted (used to avoid capturing our
     * own floating window).
     */
    private suspend fun requestSnapshot(minTimestamp: Long = 0L): Bitmap? {
        val fresh = latestFrame
        if (fresh != null && !fresh.isRecycled &&
            latestFrameAt >= minTimestamp &&
            SystemClock.elapsedRealtime() - latestFrameAt < 1500
        ) {
            return fresh
        }
        return suspendCancellableCoroutine { continuation ->
            val delivered = AtomicBoolean(false)
            val deliver: (Bitmap?) -> Unit = { bitmap ->
                if (delivered.compareAndSet(false, true) && continuation.isActive) {
                    continuation.resume(bitmap)
                }
            }
            val id = Any()
            pendingSnapshotId = id
            pendingSnapshotMinTime = minTimestamp
            pendingSnapshot = { bitmap ->
                if (pendingSnapshotId === id) {
                    pendingSnapshotId = null
                    pendingSnapshot = null
                    deliver(bitmap)
                }
            }
            mainHandler.postDelayed({
                if (pendingSnapshotId === id) {
                    pendingSnapshotId = null
                    pendingSnapshot = null
                    val frame = latestFrame
                    deliver(
                        if (frame != null && !frame.isRecycled && latestFrameAt >= minTimestamp) {
                            frame
                        } else {
                            null
                        },
                    )
                }
            }, SNAPSHOT_TIMEOUT_MS)
            continuation.invokeOnCancellation {
                mainHandler.post {
                    if (pendingSnapshotId === id) {
                        pendingSnapshotId = null
                        pendingSnapshot = null
                    }
                }
            }
        }
    }

    private fun analyze() {
        if (projection == null || !isRunning) {
            overlay?.showError(getString(R.string.toast_no_screen))
            return
        }
        val settings = settingsStore.load()
        analysisJob?.cancel()
        analysisJob = serviceScope.launch {
            try {
                if (settings.isDemo) {
                    val pattern = demoDeck.next(SystemClock.elapsedRealtime())
                    if (pattern == null) {
                        overlay?.toast(getString(R.string.demo_cooldown))
                        return@launch
                    }
                    overlay?.showLoading()
                    delay(650)
                    overlay?.showAnalysis(pattern)
                    return@launch
                }
                if (!settings.isConfigured) {
                    overlay?.showError(getString(R.string.toast_api_missing))
                    return@launch
                }
                overlay?.removeForCapture()
                val hideAt = SystemClock.elapsedRealtime()
                delay(OVERLAY_HIDE_SETTLE_MS)
                val frame = requestSnapshot(minTimestamp = hideAt + FRESH_FRAME_MARGIN_MS)
                ensureActive()
                if (frame == null) {
                    overlay?.showError(getString(R.string.toast_capture_failed))
                    return@launch
                }
                overlay?.showLoading()
                val jpeg = withContext(Dispatchers.Default) {
                    runCatching { ImageTools.encodeForAi(frame, settings.crop) }.getOrNull()
                }
                ensureActive()
                if (jpeg == null || jpeg.isEmpty()) {
                    overlay?.showError(getString(R.string.toast_capture_failed))
                    return@launch
                }
                val result = withContext(Dispatchers.IO) {
                    AiClient.analyze(settings, jpeg, previousTitles)
                }
                ensureActive()
                previousTitles = (previousTitles + result.suggestions.map { it.title })
                    .takeLast(4)
                    .toMutableList()
                overlay?.showAnalysis(result)
            } catch (error: CancellationException) {
                throw error
            } catch (error: AiException) {
                overlay?.showError(error.message ?: "分析失败，请稍后重试。")
            } catch (error: Exception) {
                overlay?.showError("分析失败：${error.message ?: "未知错误"}")
            }
        }
    }

    private fun beginCrop() {
        if (projection == null || !isRunning) {
            overlay?.showError(getString(R.string.toast_no_screen))
            return
        }
        analysisJob?.cancel()
        overlay?.removeForCapture()
        val hideAt = SystemClock.elapsedRealtime()
        serviceScope.launch {
            try {
                delay(OVERLAY_HIDE_SETTLE_MS)
                val frame = requestSnapshot(minTimestamp = hideAt + FRESH_FRAME_MARGIN_MS)
                if (frame == null) {
                    overlay?.showError(getString(R.string.toast_capture_failed))
                    return@launch
                }
                val current = settingsStore.load().crop
                overlay?.showCrop(
                    bitmap = frame,
                    initial = current,
                    onConfirm = { region ->
                        settingsStore.updateCrop(region)
                        overlay?.showWelcome(getString(R.string.overlay_crop_updated))
                    },
                    onCancel = {
                        overlay?.showWelcome()
                    },
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                overlay?.showError("打开框选失败：${error.message ?: "未知错误"}")
            }
        }
    }

    private fun buildDemoPatterns(): List<Analysis> {
        fun pattern(vararg items: Triple<SuggestionType, Int, Int>): Analysis = Analysis(
            reading = getString(R.string.demo_reading),
            suggestions = items.map { (type, title, body) ->
                Suggestion(type, getString(title), getString(body))
            },
        )
        return listOf(
            pattern(
                Triple(
                    SuggestionType.INSIGHT,
                    R.string.demo_suggestion_1_title,
                    R.string.demo_suggestion_1_body,
                ),
                Triple(
                    SuggestionType.EXTEND,
                    R.string.demo_suggestion_2_title,
                    R.string.demo_suggestion_2_body,
                ),
                Triple(
                    SuggestionType.QUESTION,
                    R.string.demo_suggestion_3_title,
                    R.string.demo_suggestion_3_body,
                ),
            ),
            pattern(
                Triple(
                    SuggestionType.CHECK,
                    R.string.demo_suggestion_4_title,
                    R.string.demo_suggestion_4_body,
                ),
                Triple(
                    SuggestionType.INSIGHT,
                    R.string.demo_suggestion_5_title,
                    R.string.demo_suggestion_5_body,
                ),
                Triple(
                    SuggestionType.EXTEND,
                    R.string.demo_suggestion_6_title,
                    R.string.demo_suggestion_6_body,
                ),
            ),
            pattern(
                Triple(
                    SuggestionType.EXTEND,
                    R.string.demo_suggestion_7_title,
                    R.string.demo_suggestion_7_body,
                ),
                Triple(
                    SuggestionType.QUESTION,
                    R.string.demo_suggestion_8_title,
                    R.string.demo_suggestion_8_body,
                ),
                Triple(
                    SuggestionType.INSIGHT,
                    R.string.demo_suggestion_9_title,
                    R.string.demo_suggestion_9_body,
                ),
            ),
        )
    }

    private fun onProjectionStopped() {
        if (destroyed) return
        isRunning = false
        overlay?.showError(getString(R.string.toast_projection_stopped))
        mainHandler.postDelayed({ stopSelf() }, 1600)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notif_channel),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.notif_text)
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val contentIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stopIntent = PendingIntent.getService(
            this,
            1,
            stopIntent(this),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_logo)
            .setContentTitle(getString(R.string.notif_title))
            .setContentText(getString(R.string.notif_text))
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(contentIntent)
            .addAction(0, getString(R.string.notif_stop), stopIntent)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }
}
