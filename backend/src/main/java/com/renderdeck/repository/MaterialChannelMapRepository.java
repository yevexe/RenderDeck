package com.renderdeck.repository;

import com.renderdeck.entity.MaterialChannelMap;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface MaterialChannelMapRepository extends JpaRepository<MaterialChannelMap, UUID> {
    List<MaterialChannelMap> findByMaterialId(UUID materialId);
    Optional<MaterialChannelMap> findByMaterialIdAndChannel(UUID materialId, String channel);
    void deleteByMaterialId(UUID materialId);
}
