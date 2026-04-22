package com.renderdeck.service;

import com.renderdeck.entity.Asset;
import com.renderdeck.exception.ForbiddenException;
import com.renderdeck.exception.NotFoundException;
import com.renderdeck.repository.AssetRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class AssetService {

    private final AssetRepository assetRepository;
    private final SupabaseStorageService storageService;

    // Allowed extensions → expected magic bytes (null = text format, skip magic check)
    private static final Map<String, byte[]> ALLOWED_TYPES = Map.of(
        "jpg",  new byte[]{(byte)0xFF, (byte)0xD8, (byte)0xFF},
        "jpeg", new byte[]{(byte)0xFF, (byte)0xD8, (byte)0xFF},
        "png",  new byte[]{(byte)0x89, 0x50, 0x4E, 0x47},
        "glb",  new byte[]{0x67, 0x6C, 0x54, 0x46},  // "glTF"
        "obj",  null,
        "mtl",  null
    );

    private void validateFile(MultipartFile file) throws IOException {
        String original = file.getOriginalFilename();
        if (original == null || !original.contains(".")) {
            throw new IllegalArgumentException("File must have an extension");
        }
        String ext = original.substring(original.lastIndexOf('.') + 1).toLowerCase();
        if (!ALLOWED_TYPES.containsKey(ext)) {
            throw new IllegalArgumentException("File type not allowed: " + ext);
        }
        byte[] magic = ALLOWED_TYPES.get(ext);
        if (magic != null) {
            byte[] header = file.getBytes();
            if (header.length < magic.length) {
                throw new IllegalArgumentException("File too small to be valid");
            }
            for (int i = 0; i < magic.length; i++) {
                if (header[i] != magic[i]) {
                    throw new IllegalArgumentException("File content does not match its extension");
                }
            }
        }
    }

    private String sanitizeFilename(String original) {
        if (original == null) return "file";
        // Keep only alphanumerics, dots, dashes, underscores; collapse everything else to _
        return original.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    @Transactional
    public Asset upload(UUID userId, UUID projectId, MultipartFile file) throws IOException {
        validateFile(file);
        String safeName = sanitizeFilename(file.getOriginalFilename());
        String storagePath = userId + "/" + UUID.randomUUID() + "_" + safeName;
        storageService.upload(storagePath, file);

        Asset asset = new Asset();
        asset.setUserId(userId);
        asset.setProjectId(projectId);
        asset.setStoragePath(storagePath);
        asset.setMimeType(file.getContentType());
        asset.setSizeBytes(file.getSize());
        asset.setOriginalFilename(safeName);
        return assetRepository.save(asset);
    }

    @Transactional
    public void delete(UUID assetId, UUID requestingUserId) {
        Asset asset = assetRepository.findById(assetId)
                .orElseThrow(() -> new NotFoundException("Asset not found"));
        if (!asset.getUserId().equals(requestingUserId)) {
            throw new ForbiddenException();
        }
        storageService.delete(asset.getStoragePath());
        assetRepository.delete(asset);
    }

    public String getSignedUrl(UUID assetId, UUID requestingUserId) {
        Asset asset = assetRepository.findById(assetId)
                .orElseThrow(() -> new NotFoundException("Asset not found"));
        if (!asset.getUserId().equals(requestingUserId)) {
            throw new ForbiddenException();
        }
        return storageService.getSignedUrl(asset.getStoragePath(), 3600);
    }
}
