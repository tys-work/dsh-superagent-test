package com.suimo.assistant

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings as AndroidSettings
import android.text.InputType
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.widget.doAfterTextChanged
import androidx.lifecycle.lifecycleScope
import com.suimo.assistant.ai.AiClient
import com.suimo.assistant.data.CropRegion
import com.suimo.assistant.data.Provider
import com.suimo.assistant.data.Settings
import com.suimo.assistant.data.SettingsStore
import com.suimo.assistant.databinding.ActivityMainBinding
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var settingsStore: SettingsStore

    private var selectedProvider: Provider = Provider.DEMO
    private var currentCrop: CropRegion = CropRegion.FULL
    private var apiKeyVisible = false
    private var starting = false

    private val captureLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val data = result.data
        if (result.resultCode == Activity.RESULT_OK && data != null) {
            startAssistantService(result.resultCode, data)
        } else {
            toast("未授予屏幕采集权限")
            starting = false
            refreshRunningState()
        }
    }

    private val notificationLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {
        requestProjection()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        settingsStore = SettingsStore(this)
        bindActions()
        loadSettingsToForm()
        refreshPermissionState()
    }

    override fun onResume() {
        super.onResume()
        refreshPermissionState()
        currentCrop = settingsStore.load().crop
        updateCropSummary()
        starting = false
        refreshRunningState()
    }

    private fun bindActions() {
        binding.grantOverlay.setOnClickListener { openOverlaySettings() }
        binding.saveSettings.setOnClickListener {
            saveSettings(showToast = true)
        }
        binding.showApiKey.setOnClickListener { toggleApiKeyVisibility() }
        binding.testConnection.setOnClickListener { testConnection() }
        binding.resetCrop.setOnClickListener {
            currentCrop = CropRegion.FULL
            settingsStore.updateCrop(currentCrop)
            updateCropSummary()
            toast(getString(R.string.toast_saved))
        }
        binding.startButton.setOnClickListener {
            if (AssistantService.isRunning) {
                stopAssistant()
            } else {
                startAssistant()
            }
        }
        binding.baseUrlInput.doAfterTextChanged { updateStartHint() }
        binding.modelInput.doAfterTextChanged { updateStartHint() }
        binding.apiKeyInput.doAfterTextChanged { updateStartHint() }
    }

    private fun loadSettingsToForm() {
        val settings = settingsStore.load()
        selectedProvider = settings.providerInfo
        currentCrop = settings.crop
        binding.baseUrlInput.setText(settings.baseUrl)
        binding.modelInput.setText(settings.model)
        binding.apiKeyInput.setText(settings.apiKey)
        binding.providerHint.text = selectedProvider.hint
        renderProviderChips()
        updateCropSummary()
        updateStartHint()
        refreshRunningState()
    }

    private fun renderProviderChips() {
        binding.providerRow.removeAllViews()
        val density = resources.displayMetrics.density
        Provider.entries.forEach { provider ->
            val chip = TextView(this, null, 0, R.style.Widget_Suimo_Chip).apply {
                text = provider.label
                isSelected = provider == selectedProvider
                setPadding(
                    (13 * density).roundToInt(),
                    (9 * density).roundToInt(),
                    (13 * density).roundToInt(),
                    (9 * density).roundToInt(),
                )
                val params = android.widget.LinearLayout.LayoutParams(
                    android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                    android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                )
                params.marginEnd = (8 * density).roundToInt()
                layoutParams = params
                setOnClickListener {
                    selectedProvider = provider
                    renderProviderChips()
                    binding.providerHint.text = provider.hint
                    if (provider != Provider.DEMO && provider != Provider.CUSTOM) {
                        binding.baseUrlInput.setText(provider.defaultBaseUrl)
                        binding.modelInput.setText(provider.defaultModel)
                    }
                    updateStartHint()
                }
            }
            binding.providerRow.addView(chip)
        }
    }

    private fun toggleApiKeyVisibility() {
        apiKeyVisible = !apiKeyVisible
        val selection = binding.apiKeyInput.selectionEnd.coerceAtLeast(0)
        val type = if (apiKeyVisible) {
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
        } else {
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        binding.apiKeyInput.inputType = type
        binding.apiKeyInput.setSelection(selection.coerceAtMost(binding.apiKeyInput.text.length))
        binding.showApiKey.text = getString(
            if (apiKeyVisible) R.string.hide_key else R.string.show_key,
        )
    }

    private fun collectSettings(): Settings = Settings(
        provider = selectedProvider.id,
        baseUrl = binding.baseUrlInput.text?.toString()?.trim().orEmpty(),
        model = binding.modelInput.text?.toString()?.trim().orEmpty(),
        apiKey = binding.apiKeyInput.text?.toString()?.trim().orEmpty(),
        crop = currentCrop,
    )

    private fun saveSettings(showToast: Boolean) {
        val settings = collectSettings()
        settingsStore.save(settings)
        currentCrop = settings.crop
        updateCropSummary()
        updateStartHint()
        if (showToast) toast(getString(R.string.toast_saved))
    }

    private fun startAssistant() {
        if (starting) return
        val settings = collectSettings()
        if (!AndroidSettings.canDrawOverlays(this)) {
            toast(getString(R.string.toast_overlay_needed))
            openOverlaySettings()
            return
        }
        if (!settings.isDemo && !settings.isConfigured) {
            toast(getString(R.string.toast_api_missing))
            return
        }
        saveSettings(showToast = false)
        starting = true
        binding.startButton.text = getString(R.string.toast_starting)
        binding.startButton.isEnabled = false
        hideKeyboard()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            requestProjection()
        }
    }

    private fun requestProjection() {
        val manager = getSystemService(MediaProjectionManager::class.java)
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForUserChoice())
        } else {
            manager.createScreenCaptureIntent()
        }
        captureLauncher.launch(intent)
    }

    private fun startAssistantService(resultCode: Int, data: Intent) {
        val intent = AssistantService.startIntent(this, resultCode, data)
        ContextCompat.startForegroundService(this, intent)
        binding.startButton.postDelayed({
            starting = false
            refreshRunningState()
        }, 1200)
    }

    private fun stopAssistant() {
        stopService(Intent(this, AssistantService::class.java))
        binding.startButton.postDelayed({ refreshRunningState() }, 400)
        refreshRunningState()
    }

    private fun refreshRunningState() {
        val running = AssistantService.isRunning
        binding.startButton.isEnabled = !starting
        binding.startButton.text = getString(
            when {
                starting -> R.string.toast_starting
                running -> R.string.stop
                else -> R.string.start
            },
        )
        if (running && !starting) {
            binding.startButton.setBackgroundResource(R.drawable.bg_button_ghost)
            binding.startButton.setTextColor(ContextCompat.getColor(this, R.color.danger))
        } else {
            binding.startButton.setBackgroundResource(R.drawable.bg_button_primary)
            binding.startButton.setTextColor(ContextCompat.getColor(this, R.color.on_accent))
        }
        binding.captureStatus.text = getString(
            if (running) R.string.capture_running else R.string.capture_idle,
        )
        binding.captureDot.setBackgroundResource(
            if (running) R.drawable.bg_dot_ok else R.drawable.bg_dot_off,
        )
        updateStartHint()
    }

    private fun updateStartHint() {
        binding.startHint.setText(
            if (selectedProvider == Provider.DEMO) {
                R.string.start_hint_demo
            } else {
                R.string.start_hint
            },
        )
    }

    private fun refreshPermissionState() {
        val allowed = AndroidSettings.canDrawOverlays(this)
        binding.overlayStatus.setText(
            if (allowed) R.string.overlay_granted else R.string.overlay_missing,
        )
        binding.overlayDot.setBackgroundResource(
            if (allowed) R.drawable.bg_dot_ok else R.drawable.bg_dot_warn,
        )
        binding.grantOverlay.visibility = if (allowed) View.GONE else View.VISIBLE
    }

    private fun openOverlaySettings() {
        val intent = Intent(
            AndroidSettings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:$packageName"),
        )
        try {
            startActivity(intent)
        } catch (error: ActivityNotFoundException) {
            startActivity(Intent(AndroidSettings.ACTION_MANAGE_OVERLAY_PERMISSION))
        }
    }

    private fun updateCropSummary() {
        val crop = currentCrop.normalized()
        binding.cropSummary.text = if (crop.isFull) {
            getString(R.string.crop_full)
        } else {
            getString(
                R.string.crop_summary,
                (crop.left * 100).roundToInt(),
                (crop.top * 100).roundToInt(),
                (crop.right * 100).roundToInt(),
                (crop.bottom * 100).roundToInt(),
            )
        }
    }

    private fun testConnection() {
        val settings = collectSettings()
        if (!settings.isDemo && !settings.isConfigured) {
            binding.testResult.setText(R.string.toast_api_missing)
            binding.testResult.setTextColor(ContextCompat.getColor(this, R.color.danger))
            return
        }
        saveSettings(showToast = false)
        binding.testConnection.isEnabled = false
        binding.testResult.setText(R.string.testing)
        binding.testResult.setTextColor(ContextCompat.getColor(this, R.color.text_3))
        lifecycleScope.launch {
            try {
                val message = withContext(Dispatchers.IO) { AiClient.testConnection(settings) }
                binding.testResult.text = getString(R.string.test_ok) + " · " + message
                binding.testResult.setTextColor(ContextCompat.getColor(this@MainActivity, R.color.jade))
            } catch (error: Exception) {
                binding.testResult.text = getString(
                    R.string.test_failed,
                    error.message ?: "未知错误",
                )
                binding.testResult.setTextColor(ContextCompat.getColor(this@MainActivity, R.color.danger))
            } finally {
                binding.testConnection.isEnabled = true
            }
        }
    }

    private fun hideKeyboard() {
        val imm = getSystemService(InputMethodManager::class.java)
        imm?.hideSoftInputFromWindow(binding.root.windowToken, 0)
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }
}
