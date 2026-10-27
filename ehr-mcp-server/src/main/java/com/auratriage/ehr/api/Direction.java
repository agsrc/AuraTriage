package com.auratriage.ehr.api;

import com.fasterxml.jackson.annotation.JsonValue;
import java.util.Locale;

/** Trend direction on the wire: {@code rising}, {@code falling} or {@code stable}. */
public enum Direction {
    RISING,
    FALLING,
    STABLE;

    @JsonValue
    public String wireValue() {
        return name().toLowerCase(Locale.ROOT);
    }
}
