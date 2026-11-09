package com.suimo.assistant.ai

/** The four suggestion kinds shared with pad-notes-ai. */
enum class SuggestionType(val id: String, val label: String) {
    INSIGHT("insight", "洞察"),
    CHECK("check", "检查"),
    EXTEND("extend", "拓展"),
    QUESTION("question", "提问"),
    ;

    companion object {
        private val aliases = mapOf(
            "洞察" to INSIGHT,
            "检查" to CHECK,
            "纠错" to CHECK,
            "拓展" to EXTEND,
            "提问" to QUESTION,
            "问题" to QUESTION,
            "启发" to QUESTION,
        )

        fun from(raw: String?): SuggestionType? =
            entries.firstOrNull { it.id == raw } ?: aliases[raw]
    }
}

data class Suggestion(
    val type: SuggestionType,
    val title: String,
    val body: String,
)

data class Analysis(
    val reading: String,
    val suggestions: List<Suggestion>,
)
