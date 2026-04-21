package com.renderdeck.repository;

import com.renderdeck.entity.Decal;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface DecalRepository extends JpaRepository<Decal, UUID> {
    List<Decal> findByPartId(UUID partId);
    void deleteByPartId(UUID partId);
}
