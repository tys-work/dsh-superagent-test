package com.suimo.assistant.ai

import com.suimo.assistant.data.CropRegion
import com.suimo.assistant.data.Provider
import com.suimo.assistant.data.Settings
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AiClientTest {

    private val settings = Settings(
        provider = Provider.OPENAI.id,
        baseUrl = "https://api.openai.com/v1/",
        model = "gpt-4o-mini",
        apiKey = "sk-test",
        crop = CropRegion(0.1f, 0.1f, 0.9f, 0.9f),
    )

    @Test
    fun endpointIsNormalized() {
        assertEquals(
            "https://api.openai.com/v1/chat/completions",
            AiClient.endpointFor("https://api.openai.com/v1/"),
        )
        assertEquals(
            "https://example.test/chat/completions",
            AiClient.endpointFor("https://example.test/chat/completions"),
        )
    }

    @Test
    fun requestBodyCarriesSystemPromptAndImage() {
        val body = JSONObject(AiClient.buildRequestBody(settings, "abc123", listOf("旧建议")))
        assertEquals("gpt-4o-mini", body.getString("model"))
        assertEquals(800, body.getInt("max_tokens"))
        val messages = body.getJSONArray("messages")
        assertEquals(2, messages.length())
        val system = messages.getJSONObject(0)
        assertEquals("system", system.getString("role"))
        assertEquals(Prompts.SUGGESTION_SYSTEM, system.getString("content"))
        val user = messages.getJSONObject(1)
        assertEquals("user", user.getString("role"))
        val parts = user.getJSONArray("content")
        assertEquals(2, parts.length())
        assertTrue(parts.getJSONObject(0).getString("text").contains("旧建议"))
        assertEquals(
            "data:image/jpeg;base64,abc123",
            parts.getJSONObject(1).getJSONObject("image_url").getString("url"),
        )
    }

    @Test
    fun contentSupportsStringAndArrayShapes() {
        val asString = JSONObject(
            """{"choices":[{"message":{"content":"{\"reading\":\"x\"}"}}]}""",
        ).toString()
        assertEquals("{\"reading\":\"x\"}", AiClient.extractContent(asString))

        val asArray = """
            {"choices":[{"message":{"content":[{"type":"text","text":"甲"},{"type":"text","text":"乙"}]}}]}
        """.trimIndent()
        assertEquals("甲乙", AiClient.extractContent(asArray))
        assertEquals("", AiClient.extractContent("{}"))
    }
}
