package com.renderdeck.repository;

import com.renderdeck.entity.Asset;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface AssetRepository extends JpaRepository<Asset, UUID> {
    List<Asset> findByUserId(UUID userId);
    List<Asset> findByProjectId(UUID projectId);
}
