package com.renderdeck.service;

import com.renderdeck.entity.Asset;
import com.renderdeck.entity.PropAsset;
import com.renderdeck.repository.PropAssetRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class PropAssetService {

    private final PropAssetRepository propAssetRepository;
    private final AssetService assetService;

    public List<PropAsset> getPropsForProject(UUID projectId) {
        return propAssetRepository.findByProjectId(projectId);
    }

    @Transactional
    public PropAsset upload(UUID userId, UUID projectId, String name, MultipartFile file) throws IOException {
        Asset asset = assetService.upload(userId, projectId, file);

        PropAsset prop = new PropAsset();
        prop.setProjectId(projectId);
        prop.setName(name);
        prop.setAssetId(asset.getId());
        return propAssetRepository.save(prop);
    }

    @Transactional
    public void delete(UUID propAssetId, UUID requestingUserId) {
        PropAsset prop = propAssetRepository.findById(propAssetId)
                .orElseThrow(() -> new RuntimeException("Prop asset not found"));
        assetService.delete(prop.getAssetId(), requestingUserId);
        propAssetRepository.delete(prop);
    }
}
