package com.auratriage.ehr.api;

import com.fasterxml.jackson.annotation.JsonValue;
import java.util.Locale;

/** Booking outcome on the wire: {@code booked}, {@code slot_taken} or {@code slot_not_found}. */
public enum BookingStatus {
    BOOKED,
    SLOT_TAKEN,
    SLOT_NOT_FOUND;

    @JsonValue
    public String wireValue() {
        return name().toLowerCase(Locale.ROOT);
    }
}
