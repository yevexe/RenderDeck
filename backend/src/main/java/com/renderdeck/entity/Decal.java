package com.renderdeck.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.util.UUID;

@Entity
@Table(name = "decals")
@Getter @Setter
public class Decal {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "part_id", nullable = false)
    private UUID partId;

    @Column(name = "asset_id", nullable = false)
    private UUID assetId;

    @Column(name = "pos_x")
    private double posX;

    @Column(name = "pos_y")
    private double posY;

    @Column(name = "scale_x")
    private double scaleX = 1.0;

    @Column(name = "scale_y")
    private double scaleY = 1.0;

    private double rotation;

    @Column(name = "layer_order", nullable = false)
    private int layerOrder;
}
