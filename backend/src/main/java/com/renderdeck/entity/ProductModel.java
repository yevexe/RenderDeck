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

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "name")
    private String name;

    // Label of a standard built-in model (e.g. "Cup"), null if custom upload
    @Column(name = "base_model")
    private String baseModel;

    // Asset UUID of uploaded OBJ/GLB file, null if using a standard model
    @Column(name = "custom_model_asset_id")
    private UUID customModelAssetId;

    // "standard" | "uploaded" | "sketchfab"
    @Column(name = "source_type")
    private String sourceType = "standard";
}
