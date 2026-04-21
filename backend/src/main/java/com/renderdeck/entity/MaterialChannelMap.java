package com.renderdeck.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.util.UUID;

@Entity
@Table(name = "material_channel_maps")
@Getter @Setter
public class MaterialChannelMap {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "material_id", nullable = false)
    private UUID materialId;

    // e.g. normalMap, roughnessMap, metalnessMap, aoMap
    @Column(nullable = false)
    private String channel;

    @Column(name = "asset_id", nullable = false)
    private UUID assetId;
}
