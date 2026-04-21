package com.renderdeck.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.util.Map;
import java.util.UUID;

@Entity
@Table(name = "parts")
@Getter @Setter
public class Part {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "model_id", nullable = false)
    private UUID modelId;

    @Column(nullable = false)
    private String name;

    // Null = standard built-in preset (Default White, Brushed Metal, etc.)
    @Column(name = "material_id")
    private UUID materialId;

    // Per-part PBR scalar overrides on top of the referenced material preset.
    // Only fields that differ from the preset are stored here — null means use preset as-is.
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "material_overrides", columnDefinition = "jsonb")
    private Map<String, Object> materialOverrides;
}
