package com.renderdeck.repository;

import com.renderdeck.entity.Material;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface MaterialRepository extends JpaRepository<Material, UUID> {
    List<Material> findByProjectId(UUID projectId);
    List<Material> findByUserId(UUID userId);
}
