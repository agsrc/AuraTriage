package com.auratriage.ehr.repo;

import com.auratriage.ehr.domain.Encounter;
import com.auratriage.ehr.domain.Patient;
import com.auratriage.ehr.domain.Provider;
import com.auratriage.ehr.domain.Slot;
import com.auratriage.ehr.domain.VitalReading;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;

/**
 * Synthetic seed data. Every person here is fictional.
 *
 * <p>The patient names are deliberately unusual "PHI canaries": tests in every workspace search
 * logs and tool output for them to prove no PHI leaks. Do not rename them without updating those
 * tests (see docs/contracts.md).
 */
final class SeedData {

    private static final int SLOT_DAYS_AHEAD = 5;
    private static final int SLOT_MINUTES = 30;
    private static final List<LocalTime> SLOT_TIMES =
            List.of(LocalTime.of(9, 0), LocalTime.of(10, 30), LocalTime.of(14, 0));

    private SeedData() {}

    static List<Patient> patients() {
        return List.of(
                new Patient(
                        "P-1001",
                        "Ada Quillfeather",
                        LocalDate.of(1971, 3, 14),
                        "14 Marrowbone Lane, Fictional Heights",
                        List.of("hypertension", "type_2_diabetes"),
                        List.of("lisinopril 10 mg daily", "metformin 500 mg twice daily"),
                        List.of("penicillin"),
                        List.of(
                                encounter("2025-11-04", "primary_care_visit", "Routine diabetes review, HbA1c 7.2 percent."),
                                encounter("2025-11-18", "lab_review", "Repeat labs reviewed, no change."),
                                encounter("2026-02-10", "primary_care_visit", "Blood pressure mildly elevated, adherence counselling."),
                                encounter("2026-06-02", "cardiology_consult", "Home readings trending up, ECG normal."),
                                encounter("2026-06-20", "primary_care_visit", "Antihypertensive dose adjusted.")),
                        List.of(vitals("2026-02-10", 132, 74), vitals("2026-06-02", 138, 72), vitals("2026-06-20", 146, 73))),
                new Patient(
                        "P-1002",
                        "Bram Oakhollow",
                        LocalDate.of(1989, 9, 30),
                        "7 Thistledown Court, Imaginary Vale",
                        List.of("asthma"),
                        List.of("albuterol inhaler as needed"),
                        List.of(),
                        List.of(
                                encounter("2026-01-12", "urgent_care_visit", "Wheeze after a cold, nebuliser given."),
                                encounter("2026-01-20", "primary_care_visit", "Asthma follow-up, inhaler technique reviewed."),
                                encounter("2026-08-05", "primary_care_visit", "Annual physical, no concerns.")),
                        List.of(vitals("2026-01-12", 118, 70), vitals("2026-01-20", 120, 74), vitals("2026-08-05", 119, 68))),
                new Patient(
                        "P-1003",
                        "Celeste Thornbury",
                        LocalDate.of(1958, 12, 2),
                        "92 Larkspur Row, Made-Up Meadows",
                        List.of("atrial_fibrillation", "hypertension"),
                        List.of("apixaban 5 mg twice daily", "metoprolol 50 mg daily"),
                        List.of("sulfa"),
                        List.of(
                                encounter("2026-03-03", "cardiology_consult", "Rate control reviewed, anticoagulation continued."),
                                encounter("2026-03-24", "lab_review", "Renal function stable on apixaban."),
                                encounter("2026-07-14", "cardiology_consult", "Palpitations settled."),
                                encounter("2026-09-01", "primary_care_visit", "Flu vaccine and medication reconciliation.")),
                        List.of(vitals("2026-03-03", 136, 96), vitals("2026-07-14", 134, 86), vitals("2026-09-01", 132, 76))),
                new Patient(
                        "P-1004",
                        "Dev Marlowe-Finch",
                        LocalDate.of(1996, 5, 21),
                        "3 Nightingale Close, Pretend Park",
                        List.of("migraine"),
                        List.of("sumatriptan 50 mg as needed"),
                        List.of(),
                        List.of(
                                encounter("2026-04-09", "neurology_consult", "Migraine with aura, triptan prescribed."),
                                encounter("2026-05-12", "neurology_consult", "Frequency down to two per month."),
                                encounter("2026-09-22", "primary_care_visit", "Headache diary reviewed.")),
                        List.of(vitals("2026-04-09", 112, 64), vitals("2026-05-12", 110, 66), vitals("2026-09-22", 114, 65))),
                new Patient(
                        "P-1005",
                        "Esme Ravenscroft",
                        LocalDate.of(1934, 7, 8),
                        "28 Hollyhock Walk, Notreal-on-Sea",
                        List.of("osteoarthritis", "hypertension"),
                        List.of("paracetamol 1 g as needed", "amlodipine 5 mg daily"),
                        List.of(),
                        List.of(
                                encounter("2026-02-02", "primary_care_visit", "Knee pain review."),
                                encounter("2026-04-14", "primary_care_visit", "Home visit, mobility assessment."),
                                encounter("2026-04-30", "physiotherapy_referral", "Referral placed."),
                                encounter("2026-08-18", "primary_care_visit", "Blood pressure review.")),
                        List.of(vitals("2026-02-02", 150, 78), vitals("2026-04-14", 148, 80), vitals("2026-08-18", 152, 79))));
    }

    static List<Provider> providers() {
        return List.of(
                new Provider("D-2001", "Dr. Imogen Hartley", "primary_care"),
                new Provider("D-2002", "Dr. Kwame Bellweather", "primary_care"),
                new Provider("D-2003", "Dr. Soraya Lindqvist", "cardiology"),
                new Provider("D-2004", "Dr. Tobias Wren", "cardiology"),
                new Provider("D-2005", "Dr. Marguerite Alder", "dermatology"),
                new Provider("D-2006", "Dr. Nikhil Prasad-Orme", "neurology"));
    }

    /** Weekday slots for the next {@value #SLOT_DAYS_AHEAD} working days, relative to {@code today}. */
    static List<Slot> slots(List<Provider> providers, LocalDate today) {
        List<Slot> result = new ArrayList<>();
        int sequence = 1000;
        for (Provider provider : providers) {
            LocalDate day = today;
            int workingDays = 0;
            while (workingDays < SLOT_DAYS_AHEAD) {
                day = day.plusDays(1);
                if (day.getDayOfWeek() == DayOfWeek.SATURDAY || day.getDayOfWeek() == DayOfWeek.SUNDAY) {
                    continue;
                }
                workingDays++;
                for (LocalTime time : SLOT_TIMES) {
                    sequence++;
                    result.add(new Slot(
                            "S-%04d".formatted(sequence),
                            provider.id(),
                            day.atTime(time).toInstant(ZoneOffset.UTC),
                            SLOT_MINUTES));
                }
            }
        }
        return result;
    }

    private static Encounter encounter(String date, String type, String summary) {
        return new Encounter(LocalDate.parse(date), type, summary);
    }

    private static VitalReading vitals(String date, int systolicBp, int heartRate) {
        return new VitalReading(LocalDate.parse(date), systolicBp, heartRate);
    }
}
