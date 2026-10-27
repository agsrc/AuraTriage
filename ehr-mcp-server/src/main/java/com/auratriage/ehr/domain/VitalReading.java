package com.auratriage.ehr.domain;

import java.time.LocalDate;

/** One set of vitals taken at a visit. Redacted {@code toString}: dates tied to a patient are PHI. */
public record VitalReading(LocalDate date, int systolicBp, int heartRate) {

    @Override
    public String toString() {
        return "VitalReading[redacted]";
    }
}
