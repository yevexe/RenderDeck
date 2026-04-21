package com.renderdeck.repository;

import com.renderdeck.entity.ProductModel;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;
import java.util.UUID;

public interface ProductModelRepository extends JpaRepository<ProductModel, UUID> {
    Optional<ProductModel> findByProjectId(UUID projectId);
}
