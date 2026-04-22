# syntax=docker/dockerfile:1

# ---- Stage 1: build the jar with full JDK ----
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app

# Copy wrapper + pom first so Docker can cache dependency downloads
# across rebuilds where only source changed.
COPY .mvn .mvn
COPY mvnw pom.xml ./
RUN chmod +x mvnw && ./mvnw dependency:go-offline -B

COPY src ./src
RUN ./mvnw clean package -DskipTests -B

# ---- Stage 2: slim runtime image (JRE only, ~100MB smaller) ----
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar

EXPOSE 8080
CMD ["java", "-Xmx400m", "-jar", "app.jar"]
