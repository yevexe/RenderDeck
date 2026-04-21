package com.renderdeck.service;

import com.renderdeck.entity.Project;
import com.renderdeck.repository.ProjectRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ProjectService {

    private final ProjectRepository projectRepository;

    public List<Project> getProjectsForUser(UUID userId) {
        return projectRepository.findByUserId(userId);
    }

    public Project getProject(UUID projectId, UUID requestingUserId) {
        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new RuntimeException("Project not found"));
        if (!project.getUserId().equals(requestingUserId)) {
            throw new RuntimeException("Forbidden");
        }
        return project;
    }

    @Transactional
    public Project create(UUID userId, String name) {
        Project project = new Project();
        project.setUserId(userId);
        project.setName(name);
        return projectRepository.save(project);
    }

    @Transactional
    public Project update(UUID projectId, UUID requestingUserId, String name, UUID thumbnailAssetId) {
        Project project = getProject(projectId, requestingUserId);
        if (name != null) project.setName(name);
        if (thumbnailAssetId != null) project.setThumbnailAssetId(thumbnailAssetId);
        return projectRepository.save(project);
    }

    @Transactional
    public void delete(UUID projectId, UUID requestingUserId) {
        Project project = getProject(projectId, requestingUserId);
        projectRepository.delete(project);
    }
}
