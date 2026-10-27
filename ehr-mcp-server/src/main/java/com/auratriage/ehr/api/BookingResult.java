package com.auratriage.ehr.api;

import com.fasterxml.jackson.annotation.JsonInclude;

/** Outcome of {@code book_appointment}. {@code appointmentId} is present only when booked. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record BookingResult(BookingStatus status, String appointmentId, String slotId) {

    public static BookingResult booked(String appointmentId, String slotId) {
        return new BookingResult(BookingStatus.BOOKED, appointmentId, slotId);
    }

    public static BookingResult slotTaken(String slotId) {
        return new BookingResult(BookingStatus.SLOT_TAKEN, null, slotId);
    }

    public static BookingResult slotNotFound(String slotId) {
        return new BookingResult(BookingStatus.SLOT_NOT_FOUND, null, slotId);
    }
}
