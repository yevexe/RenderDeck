package com.renderdeck.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
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
}
