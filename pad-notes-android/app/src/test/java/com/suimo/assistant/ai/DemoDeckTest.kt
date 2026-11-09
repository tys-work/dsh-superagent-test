package com.suimo.assistant.ai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DemoDeckTest {

    private fun pattern(title: String): Analysis = Analysis(
        reading = "本地演示",
        suggestions = listOf(
            Suggestion(SuggestionType.INSIGHT, title, "body"),
        ),
    )

    @Test
    fun firstRequestIsAllowedAndSecondWithinEightSecondsIsNot() {
        val deck = DemoDeck(listOf(pattern("一"), pattern("二")))
        assertEquals("一", deck.next(0)?.suggestions?.single()?.title)
        assertNull(deck.next(1))
        assertNull(deck.next(7_999))
        assertEquals("二", deck.next(8_000)?.suggestions?.single()?.title)
    }

    @Test
    fun consecutivePatternsAreDifferent() {
        val deck = DemoDeck(listOf(pattern("一"), pattern("二"), pattern("三")))
        val first = deck.next(0)!!.suggestions.single().title
        val second = deck.next(8_000)!!.suggestions.single().title
        val third = deck.next(16_000)!!.suggestions.single().title
        assertNotEquals(first, second)
        assertNotEquals(second, third)
        assertEquals("一", deck.next(24_000)!!.suggestions.single().title)
    }

    @Test
    fun singlePatternDeckStaysBounded() {
        val deck = DemoDeck(listOf(pattern("唯一")))
        assertTrue(deck.next(0) != null)
        assertNull(deck.next(100))
        assertEquals("唯一", deck.next(8_000)?.suggestions?.single()?.title)
    }

    @Test
    fun resetAllowsImmediateFirstRequestAgain() {
        val deck = DemoDeck(listOf(pattern("一")), minIntervalMs = 10_000)
        deck.next(0)
        assertNull(deck.next(1))
        deck.reset()
        assertEquals("一", deck.next(2)?.suggestions?.single()?.title)
    }
}
