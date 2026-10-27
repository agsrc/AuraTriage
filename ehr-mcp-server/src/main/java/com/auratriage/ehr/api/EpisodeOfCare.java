package com.auratriage.ehr.api;

/** A run of related encounters. {@code start} and {@code end} are ISO-8601 dates. */
public record EpisodeOfCare(String label, String start, String end, int encounterCount) {}
