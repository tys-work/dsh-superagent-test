package com.suimo.assistant.ai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SuggestionSanitizerTest {

    private fun analysis(vararg suggestions: Suggestion): Analysis =
        Analysis(reading = "读到的内容", suggestions = suggestions.toList())

    private fun suggestion(title: String, body: String, type: SuggestionType = SuggestionType.CHECK) =
        Suggestion(type, title, body)

    @Test
    fun absoluteUrlDropsProtocolCompletionSuggestion() {
        val raw = analysis(
            suggestion(
                "接口地址需补全",
                "`api.deepseek.com/v1` 前缺 `https://`，补全后才能连接。",
            ),
            suggestion("检查公式", "第二行可能漏了单位。"),
        )
        val clean = SuggestionSanitizer.sanitize(raw, "https://api.deepseek.com/v1")
        assertEquals(1, clean.suggestions.size)
        assertEquals("检查公式", clean.suggestions.single().title)
    }

    @Test
    fun baseUrlWordingIsAlsoGuarded() {
        val raw = analysis(
            suggestion("BASE URL 有误", "BASE URL 缺少 https:// 协议前缀。"),
        )
        val clean = SuggestionSanitizer.sanitize(raw, "https://api.openai.com/v1")
        assertTrue(clean.suggestions.isEmpty())
    }

    @Test
    fun invalidSavedUrlDoesNotTriggerTheGuard() {
        val raw = analysis(
            suggestion("接口地址需补全", "`api.deepseek.com/v1` 前缺 `https://`。"),
        )
        val clean = SuggestionSanitizer.sanitize(raw, "api.deepseek.com/v1")
        assertEquals(1, clean.suggestions.size)
    }

    @Test
    fun noteUrlMistakeForAnotherHostIsKept() {
        val raw = analysis(
            suggestion(
                "示例链接缺协议",
                "笔记里的 example.org 链接前缺 https://，可以补全。",
            ),
        )
        val clean = SuggestionSanitizer.sanitize(raw, "https://api.deepseek.com/v1")
        assertEquals(1, clean.suggestions.size)
    }

    @Test
    fun unrelatedSuggestionsAreNeverTouched() {
        val raw = analysis(
            suggestion("检查公式", "第二行可能漏了单位。"),
            suggestion("举个例子", "可以补一个反例。", SuggestionType.EXTEND),
        )
        val clean = SuggestionSanitizer.sanitize(raw, "https://api.deepseek.com/v1")
        assertEquals(2, clean.suggestions.size)
    }

    @Test
    fun absoluteUrlDetectionHandlesCommonForms() {
        assertTrue(SuggestionSanitizer.isAbsoluteHttpUrl("https://api.deepseek.com/v1"))
        assertTrue(SuggestionSanitizer.isAbsoluteHttpUrl("http://192.168.1.10:8080/v1"))
        assertTrue(SuggestionSanitizer.isAbsoluteHttpUrl("https://localhost/v1"))
        assertFalse(SuggestionSanitizer.isAbsoluteHttpUrl("api.deepseek.com/v1"))
        assertFalse(SuggestionSanitizer.isAbsoluteHttpUrl("https://"))
        assertFalse(SuggestionSanitizer.isAbsoluteHttpUrl(""))
    }
}
