package com.auratriage.ehr.domain;

import java.time.LocalDate;
import java.util.List;

/**
 * Synthetic patient held by the mock EHR.
 *
 * <p>{@code name}, {@code dateOfBirth} and {@code address} are PHI-shaped. They never leave this
 * module through a tool, and {@code toString} is redacted because a record prints every component
 * by default, which would leak them into any log line that formats the object.
 */
public record Patient(
        String id,
        String name,
        LocalDate dateOfBirth,
        String address,
        List<String> conditions,
        List<String> medications,
        List<String> allergies,
        List<Encounter> encounters,
        List<VitalReading> vitals) {

    public Patient {
        conditions = List.copyOf(conditions);
        medications = List.copyOf(medications);
        allergies = List.copyOf(allergies);
        encounters = List.copyOf(encounters);
        vitals = List.copyOf(vitals);
    }

    @Override
    public String toString() {
        return "Patient[id=" + id + "]";
    }
}
