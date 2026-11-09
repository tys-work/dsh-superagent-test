package com.suimo.assistant.ai

import com.suimo.assistant.data.Settings
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.Base64
import org.json.JSONArray
import org.json.JSONObject

class AiException(message: String, val code: String = "ai") : Exception(message)

/**
 * Minimal OpenAI-compatible client, ported from pad-notes-ai/js/ai.js.
 * The app talks directly to the endpoint the user configures; the key never
 * goes through a server of ours.
 */
object AiClient {

    suspend fun analyze(
        settings: Settings,
        jpeg: ByteArray,
        previousTitles: List<String> = emptyList(),
    ): Analysis {
        validate(settings)
        val base64 = Base64.getEncoder().encodeToString(jpeg)
        val body = buildRequestBody(settings, base64, previousTitles)
        val response = post(settings, body, readTimeoutMs = 90_000)
        val content = extractContent(response)
        if (content.isBlank()) {
            throw AiException("AI 返回了空内容，请稍后重试或检查模型。", code = "empty")
        }
        return SuggestionSanitizer.sanitize(
            SuggestionParser.parse(content),
            settings.baseUrl,
        )
    }

    suspend fun testConnection(settings: Settings): String {
        if (settings.isDemo) return "演示模式无需连接，可以直接生成示例建议。"
        validate(settings)
        val messages = JSONArray()
            .put(JSONObject().put("role", "system").put("content", "你是连接测试助手。"))
            .put(JSONObject().put("role", "user").put("content", "请只回复：可用"))
        val body = JSONObject()
            .put("model", settings.model.trim())
            .put("messages", messages)
            .put("temperature", 0)
            .put("max_tokens", 12)
            .toString()
        val text = extractContent(post(settings, body, readTimeoutMs = 30_000)).trim()
        if (text.isEmpty()) throw AiException("AI 返回了空内容。", code = "empty")
        return SuggestionParser.truncate(text, 20)
    }

    internal fun endpointFor(baseUrl: String): String {
        val base = baseUrl.trim().trimEnd('/')
        return if (base.endsWith("/chat/completions")) base else "$base/chat/completions"
    }

    internal fun buildRequestBody(
        settings: Settings,
        jpegBase64: String,
        previousTitles: List<String>,
    ): String {
        val userContent = JSONArray()
            .put(
                JSONObject()
                    .put("type", "text")
                    .put("text", Prompts.buildUserText(previousTitles)),
            )
            .put(
                JSONObject()
                    .put("type", "image_url")
                    .put(
                        "image_url",
                        JSONObject().put("url", "data:image/jpeg;base64,$jpegBase64"),
                    ),
            )
        val messages = JSONArray()
            .put(JSONObject().put("role", "system").put("content", Prompts.SUGGESTION_SYSTEM))
            .put(JSONObject().put("role", "user").put("content", userContent))
        return JSONObject()
            .put("model", settings.model.trim())
            .put("messages", messages)
            .put("temperature", 0.65)
            .put("max_tokens", 800)
            .toString()
    }

    internal fun extractContent(responseBody: String): String {
        val json = JSONObject(responseBody)
        val choices = json.optJSONArray("choices") ?: return ""
        val message = choices.optJSONObject(0)?.optJSONObject("message") ?: return ""
        val content = message.opt("content") ?: return ""
        if (content is String) return content
        if (content is JSONArray) {
            val builder = StringBuilder()
            for (index in 0 until content.length()) {
                val part = content.optJSONObject(index)
                builder.append(part?.optString("text", "").orEmpty())
            }
            return builder.toString()
        }
        return content.toString()
    }

    private fun validate(settings: Settings) {
        if (settings.isDemo) return
        if (settings.baseUrl.isBlank()) throw AiException("请先在设置中填写 Base URL。", "no-base-url")
        if (settings.model.isBlank()) throw AiException("请先在设置中填写模型名称。", "no-model")
        if (settings.apiKey.isBlank()) throw AiException("请先在设置中填写 API Key。", "no-key")
    }

    private fun post(settings: Settings, body: String, readTimeoutMs: Int): String {
        val url = endpointFor(settings.baseUrl)
        var connection: HttpURLConnection? = null
        try {
            connection = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15_000
                readTimeout = readTimeoutMs
                doOutput = true
                useCaches = false
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Authorization", "Bearer ${settings.apiKey.trim()}")
            }
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (status !in 200..299) {
                throw AiException(friendlyHttpMessage(status, extractApiMessage(text)), "http-$status")
            }
            return text
        } catch (error: IOException) {
            throw AiException(
                "连接 AI 服务失败，请检查网络与 Base URL。",
                "network",
            )
        } finally {
            connection?.disconnect()
        }
    }

    private fun friendlyHttpMessage(status: Int, apiMessage: String): String = when (status) {
        401 -> "API Key 无效或已过期，请在设置中检查。"
        403 -> "该 API Key 没有访问这个模型的权限。"
        404 -> "接口地址或模型不存在，请检查 Base URL 与模型名称。"
        429 -> "请求太频繁或额度不足，请稍后再试。"
        400 -> if (apiMessage.isNotBlank()) {
            "AI 服务拒绝了这次请求：${SuggestionParser.truncate(apiMessage, 160)}"
        } else {
            "AI 服务拒绝了这次请求，请检查模型是否支持图片输入。"
        }
        in 500..599 -> "AI 服务暂时不可用，请稍后重试。"
        else -> "AI 服务返回 $status${if (apiMessage.isNotBlank()) "：${SuggestionParser.truncate(apiMessage, 140)}" else ""}"
    }

    private fun extractApiMessage(bodyText: String): String {
        return runCatching {
            val json = JSONObject(bodyText)
            json.optJSONObject("error")?.optString("message")
                ?: json.optString("message")
                ?: json.opt("error")?.toString().orEmpty()
        }.getOrDefault(
            SuggestionParser.truncate(
                bodyText.replace(Regex("\\s+"), " ").trim(),
                160,
            ),
        )
    }
}
