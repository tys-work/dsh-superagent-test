package com.suimo.assistant.ai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SuggestionParserTest {

    @Test
    fun parsesFencedJsonAndNormalizesTypes() {
        val raw = """
            ```json
            {"reading":"费曼学习法笔记","suggestions":[
              {"type":"insight","title":"用自己的话复述","body":"试着一句话讲清楚。"},
              {"type":"纠错","title":"检查公式","body":"第二行漏了单位。"},
              {"type":"question","title":"还有反例吗？","body":"举一个不成立的例子。"}
            ]}
            ```
        """.trimIndent()
        val analysis = SuggestionParser.parse(raw)
        assertEquals("费曼学习法笔记", analysis.reading)
        assertEquals(3, analysis.suggestions.size)
        assertEquals(SuggestionType.INSIGHT, analysis.suggestions[0].type)
        assertEquals(SuggestionType.CHECK, analysis.suggestions[1].type)
        assertEquals(SuggestionType.QUESTION, analysis.suggestions[2].type)
    }

    @Test
    fun capsSuggestionsAtThreeAndTruncates() {
        val longTitle = "很".repeat(80)
        val longBody = "长".repeat(300)
        val raw = """
            {"reading":"读","suggestions":[
              {"type":"insight","title":"$longTitle","body":"$longBody"},
              {"type":"insight","title":"二","body":"二"},
              {"type":"insight","title":"三","body":"三"},
              {"type":"insight","title":"四","body":"四"}
            ]}
        """.trimIndent()
        val analysis = SuggestionParser.parse(raw)
        assertEquals(3, analysis.suggestions.size)
        assertEquals(48, analysis.suggestions[0].title.length)
        assertEquals(220, analysis.suggestions[0].body.length)
        assertTrue(analysis.suggestions[0].title.endsWith("…"))
    }

    @Test
    fun unknownTypeFallsBackToInsight() {
        val analysis = SuggestionParser.parse(
            """{"suggestions":[{"type":"nonsense","title":"标题","body":"正文"}]}""",
        )
        assertEquals(SuggestionType.INSIGHT, analysis.suggestions.single().type)
    }

    @Test
    fun plainTextBecomesOneFallbackSuggestion() {
        val analysis = SuggestionParser.parse("这是一段没有 JSON 的回答。")
        assertTrue(analysis.reading.isEmpty())
        assertEquals(1, analysis.suggestions.size)
        assertEquals("AI 的想法", analysis.suggestions.single().title)
    }

    @Test
    fun emptyInputGivesEmptyAnalysis() {
        val analysis = SuggestionParser.parse("   ")
        assertTrue(analysis.suggestions.isEmpty())
        assertTrue(analysis.reading.isEmpty())
    }
}
