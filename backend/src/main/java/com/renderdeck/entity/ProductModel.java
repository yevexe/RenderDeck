package com.renderdeck.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.util.UUID;

// Named ProductModel to avoid collision with java.lang or Spring internals
@Entity
@Table(name = "models")
@Getter @Setter
public class ProductModel {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    // One-to-one with project — enforced by UNIQUE constraint in DB
    @Column(name = "project_id", nullable = false, unique = true)
    private UUID projectId;

    // Label of a standard built-in model (e.g. "Cup"), null if custom upload
    @Column(name = "base_model")
    private String baseModel;

    // Asset UUID of uploaded OBJ/GLB file, null if using a standard model
    @Column(name = "custom_model_asset_id")
    private UUID customModelAssetId;
}
