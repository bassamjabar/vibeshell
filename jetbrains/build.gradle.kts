plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "1.9.25"
    id("org.jetbrains.intellij.platform") version "2.1.0"
}

group = "com.vibeshell"
version = "0.1.0"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        // Build against the ALREADY-INSTALLED Android Studio (itself an
        // IntelliJ Platform 242 IDE with JCEF + tool windows) — no ~1GB SDK
        // download needed. Override with VIBESHELL_IDE_HOME if AS moves.
        val ideHome = System.getenv("VIBESHELL_IDE_HOME")
            ?: "C:/Program Files/Android/Android Studio"
        local(ideHome)
    }
}

intellijPlatform {
    pluginConfiguration {
        ideaVersion {
            sinceBuild.set("242")
            untilBuild.set("242.*")
        }
    }
    buildSearchableOptions.set(false)
    // We have no @NotNull/form instrumentation and building against a local
    // IDE lacks the ant instrumentation tools — skip it.
    instrumentCode.set(false)
}

// Compile targeting Java 17 bytecode using WHATEVER JDK runs Gradle — so the
// build works with Android Studio's own bundled JBR (21), needing no separate
// JDK 17 install. That's what keeps the "no downloads" promise for users who
// already have Android Studio.
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}
kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}
