package com.auratriage.ehr.api;

/** One recent encounter as shown to the agent. {@code date} is ISO-8601 (yyyy-MM-dd). */
public record EncounterSummary(String date, String type, String summary) {}
