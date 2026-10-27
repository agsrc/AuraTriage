package com.auratriage.ehr.domain;

/** The appointment that holds a slot. */
public record Booking(String appointmentId, String slotId, String patientId) {}
