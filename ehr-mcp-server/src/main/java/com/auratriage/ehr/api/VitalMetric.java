package com.auratriage.ehr.api;

import com.fasterxml.jackson.annotation.JsonValue;
import java.util.Locale;

/** Vitals we report trends for, on the wire as {@code systolic_bp} and {@code heart_rate}. */
public enum VitalMetric {
    SYSTOLIC_BP,
    HEART_RATE;

    @JsonValue
    public String wireValue() {
        return name().toLowerCase(Locale.ROOT);
    }
}
