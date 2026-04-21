package com.renderdeck.repository;

import com.renderdeck.entity.Scene;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface SceneRepository extends JpaRepository<Scene, UUID> {
    List<Scene> findByProjectId(UUID projectId);
}
