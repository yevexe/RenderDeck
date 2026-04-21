package com.renderdeck.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "profiles")
@Getter @Setter
public class Profile {

    @Id
    private UUID id; // matches auth.users.id from Supabase Auth — no generation here

    private String username;

    @Column(name = "display_name")
    private String displayName;

    private String bio;

    @Column(name = "avatar_asset_id")
    private UUID avatarAssetId;

    @Column(name = "created_at")
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) createdAt = Instant.now();
    }
}
