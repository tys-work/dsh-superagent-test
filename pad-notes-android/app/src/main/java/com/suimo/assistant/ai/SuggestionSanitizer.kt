package com.suimo.assistant.ai

/**
 * Guards against an AI suggestion that mistakes a screenshot of the app's own
 * settings for a note: the settings field can look truncated in a cropped
 * screen (e.g. "api.deepseek.com/v1" without its scheme), so the model may
 * suggest "add https://" even though the saved Base URL is already absolute.
 *
 * The check is deliberately narrow: only a suggestion that both talks about
 * completing a protocol and refers to the configured endpoint (or BASE URL /
 * 接口地址) is removed. Ordinary note suggestions are left untouched. The
 * decision always uses the saved setting, never a fragment read from an image.
 */
object SuggestionSanitizer {

    fun sanitize(analysis: Analysis, savedBaseUrl: String): Analysis {
        if (!isAbsoluteHttpUrl(savedBaseUrl)) return analysis
        val host = hostOf(savedBaseUrl)
        val filtered = analysis.suggestions.filterNot { suggestion ->
            mentionsProtocolFix(suggestion) && mentionsConfiguredEndpoint(suggestion, host)
        }
        if (filtered.size == analysis.suggestions.size) return analysis
        return analysis.copy(suggestions = filtered)
    }

    fun isAbsoluteHttpUrl(value: String): Boolean {
        val trimmed = value.trim()
        val lower = trimmed.lowercase()
        if (!lower.startsWith("https://") && !lower.startsWith("http://")) return false
        val authority = trimmed.substringAfter("://")
            .substringBefore('/')
            .substringBefore('?')
            .substringBefore('#')
        return authority.isNotBlank() && !authority.any { it.isWhitespace() }
    }

    private fun mentionsProtocolFix(suggestion: Suggestion): Boolean {
        val text = "${suggestion.title} ${suggestion.body}".lowercase()
        return listOf(
            "补全",
            "前缺",
            "缺 https",
            "缺少 https",
            "https:// 前缀",
            "https://前缀",
            "补充协议",
            "补上 https",
        ).any { text.contains(it) }
    }

    private fun mentionsConfiguredEndpoint(suggestion: Suggestion, host: String): Boolean {
        val text = "${suggestion.title} ${suggestion.body}".lowercase()
        if (text.contains("base url") || text.contains("接口地址") || text.contains("接口 url")) {
            return true
        }
        return host.isNotBlank() && text.contains(host.lowercase())
    }

    private fun hostOf(baseUrl: String): String {
        val authority = baseUrl.trim()
            .substringAfter("://")
            .substringBefore('/')
            .substringBefore('?')
            .substringBefore('#')
        // Strip a port if present.
        return authority.substringBefore(':')
    }
}
