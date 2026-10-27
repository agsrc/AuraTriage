package com.auratriage.ehr.domain;

import java.time.LocalDate;

/** One visit. The summary is free-text clinical content, so {@code toString} is redacted. */
public record Encounter(LocalDate date, String type, String summary) {

    @Override
    public String toString() {
        return "Encounter[redacted]";
    }
}
