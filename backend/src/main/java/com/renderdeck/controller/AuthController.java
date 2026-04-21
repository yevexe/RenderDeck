package com.renderdeck.controller;

import com.renderdeck.entity.Profile;
import com.renderdeck.service.ProfileService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final ProfileService profileService;

    @PostMapping("/profile")
    public Profile upsertProfile(@AuthenticationPrincipal Jwt jwt,
                                  @RequestBody Map<String, String> body) {
        UUID userId = UUID.fromString(jwt.getSubject());
        return profileService.upsert(
                userId,
                body.get("username"),
                body.get("displayName"),
                body.get("bio"));
    }

    @GetMapping("/profile")
    public Profile getProfile(@AuthenticationPrincipal Jwt jwt) {
        UUID userId = UUID.fromString(jwt.getSubject());
        return profileService.getProfile(userId);
    }
}
