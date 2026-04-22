package com.renderdeck.service;

import com.renderdeck.entity.Asset;
import com.renderdeck.entity.Project;
import com.renderdeck.entity.PropAsset;
import com.renderdeck.exception.ForbiddenException;
import com.renderdeck.exception.NotFoundException;
import com.renderdeck.repository.ProjectRepository;
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
    private final ProjectRepository projectRepository;
    private final AssetService assetService;

    private void checkProjectOwnership(UUID projectId, UUID requestingUserId) {
        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new NotFoundException("Project not found"));
        if (!project.getUserId().equals(requestingUserId)) throw new ForbiddenException();
    }

    public List<PropAsset> getPropsForProject(UUID projectId, UUID requestingUserId) {
        checkProjectOwnership(projectId, requestingUserId);
        return propAssetRepository.findByProjectId(projectId);
    }

    @Transactional
    public PropAsset upload(UUID userId, UUID projectId, String name, MultipartFile file) throws IOException {
        checkProjectOwnership(projectId, userId);
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
                .orElseThrow(() -> new NotFoundException("Prop asset not found"));
        // Asset ownership check inside AssetService.delete enforces that the requester owns the asset
        assetService.delete(prop.getAssetId(), requestingUserId);
        propAssetRepository.delete(prop);
    }
}
