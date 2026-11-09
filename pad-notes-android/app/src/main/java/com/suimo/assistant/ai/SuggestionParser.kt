package com.suimo.assistant.ai

import org.json.JSONArray
import org.json.JSONObject

/**
 * Parses the JSON contract described in [Prompts.SUGGESTION_SYSTEM].
 * Mirrors `extractJson` + `normalizeSuggestions` from pad-notes-ai/js/ai.js,
 * including the tolerant fallback for models that wrap JSON in a code fence.
 */
object SuggestionParser {

    fun parse(raw: String?): Analysis {
        val json = extractJson(raw) ?: return fallback(raw)
        return normalize(json)
    }

    fun extractJson(text: String?): JSONObject? {
        if (text.isNullOrBlank()) return null
        var value = text.trim()
        value = value.replace(Regex("^```(?:json)?\\s*", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s*```$"), "")
            .trim()
        runCatching { return JSONObject(value) }
        val start = value.indexOf('{')
        val end = value.lastIndexOf('}')
        if (start >= 0 && end > start) {
            runCatching { return JSONObject(value.substring(start, end + 1)) }
        }
        return null
    }

    fun normalize(parsed: JSONObject): Analysis {
        val reading = truncate(parsed.optString("reading", "").trim(), 80)
        val list = parsed.optJSONArray("suggestions") ?: JSONArray()
        val suggestions = ArrayList<Suggestion>()
        for (index in 0 until list.length()) {
            val item = list.optJSONObject(index) ?: continue
            val title = item.optString("title", "").trim()
            val body = item.optString("body", "").trim()
            if (title.isEmpty() && body.isEmpty()) continue
            val type = SuggestionType.from(item.optString("type", "")) ?: SuggestionType.INSIGHT
            suggestions += Suggestion(
                type = type,
                title = truncate(title.ifEmpty { "AI 的想法" }, 48),
                body = truncate(body, 220),
            )
            if (suggestions.size >= 3) break
        }
        return Analysis(reading = reading, suggestions = suggestions)
    }

    private fun fallback(raw: String?): Analysis {
        val clean = raw?.trim().orEmpty()
        if (clean.isEmpty()) return Analysis("", emptyList())
        return Analysis(
            reading = "",
            suggestions = listOf(
                Suggestion(SuggestionType.INSIGHT, "AI 的想法", truncate(clean, 200)),
            ),
        )
    }

    internal fun truncate(value: String, max: Int): String =
        if (value.length > max) value.take(max - 1) + "…" else value
}
