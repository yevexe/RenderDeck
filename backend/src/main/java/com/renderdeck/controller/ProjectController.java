package com.renderdeck.controller;

import com.renderdeck.entity.Project;
import com.renderdeck.service.ProjectService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/projects")
@RequiredArgsConstructor
public class ProjectController {

    private final ProjectService projectService;

    @GetMapping
    public List<Project> list(@AuthenticationPrincipal Jwt jwt) {
        return projectService.getProjectsForUser(UUID.fromString(jwt.getSubject()));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Project create(@AuthenticationPrincipal Jwt jwt,
                           @RequestBody Map<String, String> body) {
        String name = body.get("name");
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Project name is required");
        }
        return projectService.create(UUID.fromString(jwt.getSubject()), name.trim());
    }

    @GetMapping("/{id}")
    public Project get(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return projectService.getProject(id, UUID.fromString(jwt.getSubject()));
    }

    @PatchMapping("/{id}")
    public Project update(@AuthenticationPrincipal Jwt jwt,
                           @PathVariable UUID id,
                           @RequestBody Map<String, Object> body) {
        UUID thumbnailAssetId = body.get("thumbnailAssetId") != null
                ? UUID.fromString((String) body.get("thumbnailAssetId")) : null;
        return projectService.update(id, UUID.fromString(jwt.getSubject()),
                (String) body.get("name"), thumbnailAssetId);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        projectService.delete(id, UUID.fromString(jwt.getSubject()));
    }
}
