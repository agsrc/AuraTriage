package com.auratriage.ehr.api;

import java.util.List;

/**
 * Minimum-necessary clinical summary returned to the agent. There is deliberately no name, date of
 * birth, address or contact field: add one only if a feature truly needs it, and update
 * docs/contracts.md in the same change.
 */
public record PatientHistorySummary(
        String patientId,
        String ageBand,
        List<String> conditions,
        List<String> medications,
        List<String> allergies,
        List<EncounterSummary> recentEncounters,
        List<EpisodeOfCare> episodesOfCare,
        List<VitalsTrend> vitalsTrends) {

    @Override
    public String toString() {
        return "PatientHistorySummary[patientId=" + patientId + "]";
    }
}
