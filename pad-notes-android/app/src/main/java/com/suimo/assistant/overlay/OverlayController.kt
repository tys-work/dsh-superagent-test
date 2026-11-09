package com.suimo.assistant.overlay

import android.content.Context
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.Toast
import androidx.core.content.ContextCompat
import com.suimo.assistant.MainActivity
import com.suimo.assistant.R
import com.suimo.assistant.ai.Analysis
import com.suimo.assistant.ai.SuggestionType
import com.suimo.assistant.data.CropRegion
import com.suimo.assistant.databinding.ItemSuggestionBinding
import com.suimo.assistant.databinding.OverlayBubbleBinding
import com.suimo.assistant.databinding.OverlayCropBinding
import com.suimo.assistant.databinding.OverlayPanelBinding
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Owns the floating "墨点" and the suggestion card. One non-focusable
 * TYPE_APPLICATION_OVERLAY window sits above other apps; the user can keep
 * writing while suggestions appear. The window is removed for the instant a
 * screenshot is taken so our own UI is not captured.
 */
class OverlayController(
    private val context: Context,
    private val callbacks: Callbacks,
) {

    interface Callbacks {
        fun onAnalyze()
        fun onCrop()
        fun onOpenSettings()
    }

    private val windowManager = context.getSystemService(WindowManager::class.java)
    private val inflater = LayoutInflater.from(context)
    private val mainHandler = Handler(Looper.getMainLooper())

    private val bubbleBinding = OverlayBubbleBinding.inflate(inflater)
    private val panelBinding = OverlayPanelBinding.inflate(inflater)
    private val root = FrameLayout(context).apply {
        addView(bubbleBinding.root)
        addView(panelBinding.root)
    }

    private var windowParams: WindowManager.LayoutParams? = null
    private var attached = false
    private var panelVisible = false

    private var bubbleX = 0
    private var bubbleY = 0
    private var dragStartX = 0
    private var dragStartY = 0
    private var downRawX = 0f
    private var downRawY = 0f
    private var moved = false
    private var longPressed = false

    private var cropRoot: View? = null
    private var cropVisible = false

    private val longPressRunnable = Runnable {
        longPressed = true
        openPanel()
    }

    init {
        val screen = screenSize()
        bubbleX = (screen.x - dp(56f) - dp(12f)).toInt().coerceAtLeast(0)
        bubbleY = (screen.y * 0.40f).toInt()
        panelBinding.panelRoot.visibility = View.GONE
        configurePanel()
        configureBubble()
    }

    fun showWelcome(message: String = context.getString(R.string.overlay_welcome)) {
        setLoading(false)
        hideError()
        hideReading()
        clearSuggestions()
        panelBinding.emptyText.visibility = View.VISIBLE
        panelBinding.emptyText.text = message
        panelBinding.analyzeButton.isEnabled = true
        openPanel(reset = true)
    }

    fun showLoading() {
        hideError()
        hideReading()
        clearSuggestions()
        panelBinding.emptyText.visibility = View.GONE
        setLoading(true)
        panelBinding.analyzeButton.isEnabled = false
        openPanel(reset = true)
    }

    fun showAnalysis(analysis: Analysis) {
        hideError()
        setLoading(false)
        clearSuggestions()
        panelBinding.analyzeButton.isEnabled = true
        if (analysis.reading.isNotBlank()) {
            panelBinding.readingCard.visibility = View.VISIBLE
            panelBinding.readingText.text = analysis.reading
        } else {
            hideReading()
        }
        if (analysis.suggestions.isEmpty()) {
            panelBinding.emptyText.visibility = View.VISIBLE
            panelBinding.emptyText.text = context.getString(R.string.overlay_empty)
        } else {
            panelBinding.emptyText.visibility = View.GONE
            analysis.suggestions.forEach { suggestion ->
                val item = ItemSuggestionBinding.inflate(
                    inflater,
                    panelBinding.suggestionsContainer,
                    false,
                )
                item.typeLabel.text = "● ${suggestion.type.label}"
                item.typeLabel.setTextColor(
                    ContextCompat.getColor(context, colorFor(suggestion.type)),
                )
                item.title.text = suggestion.title
                item.body.text = suggestion.body
                panelBinding.suggestionsContainer.addView(item.root)
            }
        }
        openPanel(reset = true)
    }

    fun showError(message: String) {
        setLoading(false)
        hideReading()
        clearSuggestions()
        panelBinding.emptyText.visibility = View.GONE
        panelBinding.errorCard.visibility = View.VISIBLE
        panelBinding.errorText.text = message
        panelBinding.analyzeButton.isEnabled = true
        openPanel(reset = true)
    }

    /** Removes the whole floating window so the next frame is not polluted. */
    fun removeForCapture() {
        detachNormalWindow()
    }

    fun isAttached(): Boolean = attached

    /**
     * Freezes [bitmap] full-screen with a draggable crop rectangle. The caller
     * is responsible for restoring the assistant panel in its callbacks.
     */
    fun showCrop(
        bitmap: Bitmap,
        initial: CropRegion,
        onConfirm: (CropRegion) -> Unit,
        onCancel: () -> Unit,
    ) {
        detachNormalWindow()
        if (cropVisible) removeCropWindow()
        val binding = OverlayCropBinding.inflate(inflater)
        binding.cropView.setImage(bitmap, initial)
        binding.cropCancel.setOnClickListener {
            removeCropWindow()
            onCancel()
        }
        binding.cropConfirm.setOnClickListener {
            val region = binding.cropView.region()
            removeCropWindow()
            onConfirm(region)
        }
        binding.root.isFocusableInTouchMode = true
        binding.root.setOnKeyListener { _, keyCode, event ->
            if (keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
                removeCropWindow()
                onCancel()
                true
            } else {
                false
            }
        }
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
        }
        runCatching {
            windowManager.addView(binding.root, params)
            binding.root.requestFocus()
            cropRoot = binding.root
            cropVisible = true
        }.onFailure {
            toast(context.getString(R.string.toast_overlay_needed))
            onCancel()
        }
    }

    fun collapse() {
        panelVisible = false
        panelBinding.panelRoot.visibility = View.GONE
        bubbleBinding.root.visibility = View.VISIBLE
        attachIfNeeded()
        updateWindow()
    }

    fun openPanel(reset: Boolean = false) {
        if (reset) {
            panelBinding.panelRoot.visibility = View.VISIBLE
        } else {
            panelBinding.panelRoot.visibility = View.VISIBLE
        }
        panelVisible = true
        bubbleBinding.root.visibility = View.GONE
        attachIfNeeded()
        updateWindow()
    }

    fun detachAll() {
        mainHandler.removeCallbacks(longPressRunnable)
        removeCropWindow()
        detachNormalWindow()
    }

    fun toast(message: String) {
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
    }

    private fun configureBubble() {
        bubbleBinding.root.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downRawX = event.rawX
                    downRawY = event.rawY
                    dragStartX = windowParams?.x ?: bubbleX
                    dragStartY = windowParams?.y ?: bubbleY
                    moved = false
                    longPressed = false
                    mainHandler.postDelayed(longPressRunnable, 480)
                    true
                }

                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downRawX
                    val dy = event.rawY - downRawY
                    if (abs(dx) > dp(8f) || abs(dy) > dp(8f)) {
                        moved = true
                        mainHandler.removeCallbacks(longPressRunnable)
                    }
                    if (moved) {
                        val screen = screenSize()
                        bubbleX = (dragStartX + dx).toInt().coerceIn(0, max(0, screen.x - dp(56f).toInt()))
                        bubbleY = (dragStartY + dy).toInt().coerceIn(0, max(0, screen.y - dp(56f).toInt()))
                        updateWindow()
                    }
                    true
                }

                MotionEvent.ACTION_UP -> {
                    mainHandler.removeCallbacks(longPressRunnable)
                    if (!moved && !longPressed) {
                        callbacks.onAnalyze()
                    }
                    true
                }

                MotionEvent.ACTION_CANCEL -> {
                    mainHandler.removeCallbacks(longPressRunnable)
                    true
                }

                else -> false
            }
        }
    }

    private fun configurePanel() {
        panelBinding.closePanel.setOnClickListener { collapse() }
        panelBinding.collapseButton.setOnClickListener { collapse() }
        panelBinding.analyzeButton.setOnClickListener { callbacks.onAnalyze() }
        panelBinding.cropButton.setOnClickListener { callbacks.onCrop() }
        panelBinding.errorRetry.setOnClickListener { callbacks.onAnalyze() }
        panelBinding.openSettings.setOnClickListener { callbacks.onOpenSettings() }
    }

    private fun attachIfNeeded() {
        if (attached) return
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = bubbleX
            y = bubbleY
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        windowParams = params
        runCatching {
            windowManager.addView(root, params)
            attached = true
        }.onFailure {
            toast(context.getString(R.string.toast_overlay_needed))
        }
    }

    private fun detachNormalWindow() {
        if (!attached) return
        runCatching { windowManager.removeView(root) }
        attached = false
        windowParams = null
    }

    private fun updateWindow() {
        if (!attached) return
        val params = windowParams ?: return
        val screen = screenSize()
        if (panelVisible) {
            val panelWidth = min(dp(336f), screen.x - dp(24f)).toInt().coerceAtLeast(dp(240f).toInt())
            val lp = panelBinding.panelRoot.layoutParams as FrameLayout.LayoutParams
            lp.width = panelWidth
            panelBinding.panelRoot.layoutParams = lp
            params.width = panelWidth
            params.height = WindowManager.LayoutParams.WRAP_CONTENT
            params.x = max(0, screen.x - panelWidth - dp(12f).toInt())
            params.y = dp(52f).toInt()
        } else {
            params.width = WindowManager.LayoutParams.WRAP_CONTENT
            params.height = WindowManager.LayoutParams.WRAP_CONTENT
            params.x = bubbleX
            params.y = bubbleY
        }
        runCatching { windowManager.updateViewLayout(root, params) }
    }

    private fun removeCropWindow() {
        val view = cropRoot ?: return
        runCatching { windowManager.removeView(view) }
        cropRoot = null
        cropVisible = false
    }

    private fun setLoading(visible: Boolean) {
        panelBinding.loadingRow.visibility = if (visible) View.VISIBLE else View.GONE
    }

    private fun hideError() {
        panelBinding.errorCard.visibility = View.GONE
    }

    private fun hideReading() {
        panelBinding.readingCard.visibility = View.GONE
    }

    private fun clearSuggestions() {
        panelBinding.suggestionsContainer.removeAllViews()
    }

    private fun overlayType(): Int = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY

    private fun colorFor(type: SuggestionType): Int = when (type) {
        SuggestionType.INSIGHT -> R.color.jade
        SuggestionType.CHECK -> R.color.amber
        SuggestionType.EXTEND -> R.color.blue
        SuggestionType.QUESTION -> R.color.violet
    }

    private fun screenSize(): android.graphics.Point {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = windowManager.currentWindowMetrics.bounds
            return android.graphics.Point(bounds.width(), bounds.height())
        }
        val metrics = android.util.DisplayMetrics()
        @Suppress("DEPRECATION")
        windowManager.defaultDisplay.getRealMetrics(metrics)
        return android.graphics.Point(metrics.widthPixels, metrics.heightPixels)
    }

    private fun dp(value: Float): Float = value * context.resources.displayMetrics.density
}
