package com.renderdeck.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.util.Map;
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

    @Column(name = "size_w")
    private double sizeW = 1.0;

    @Column(name = "size_h")
    private double sizeH = 1.0;

    private double rotation;

    @Column(name = "layer_order", nullable = false)
    private int layerOrder;

    private String name;

    // "image" or "text"
    private String type = "image";

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "text_data", columnDefinition = "jsonb")
    private Map<String, Object> textData;

    @Column(name = "flip_h")
    private boolean flipH = false;

    @Column(name = "flip_v")
    private boolean flipV = false;

    @Column(name = "aspect_ratio")
    private Double aspectRatio;
}
