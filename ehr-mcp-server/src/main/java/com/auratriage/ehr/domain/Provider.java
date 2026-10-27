package com.auratriage.ehr.domain;

/** A clinician. Specialty is a lower-case snake_case code such as {@code cardiology}. */
public record Provider(String id, String name, String specialty) {}
