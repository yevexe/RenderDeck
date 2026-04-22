package com.renderdeck.service;

import com.renderdeck.entity.Profile;
import com.renderdeck.exception.NotFoundException;
import com.renderdeck.repository.ProfileRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ProfileService {

    private final ProfileRepository profileRepository;

    public Profile getProfile(UUID userId) {
        return profileRepository.findById(userId)
                .orElseThrow(() -> new NotFoundException("Profile not found"));
    }

    @Transactional
    public Profile upsert(UUID userId, String username, String displayName, String bio) {
        Profile profile = profileRepository.findById(userId).orElse(new Profile());
        profile.setId(userId);
        if (username != null) profile.setUsername(username);
        if (displayName != null) profile.setDisplayName(displayName);
        if (bio != null) profile.setBio(bio);
        return profileRepository.save(profile);
    }

    @Transactional
    public Profile updateAvatar(UUID userId, UUID avatarAssetId) {
        Profile profile = getProfile(userId);
        profile.setAvatarAssetId(avatarAssetId);
        return profileRepository.save(profile);
    }
}
