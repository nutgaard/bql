plugins {
    kotlin("jvm") version "2.1.21" apply false
    kotlin("plugin.serialization") version "2.1.21" apply false
}

allprojects {
    group = "com.example.bql"
    version = "0.0.1"

    repositories {
        mavenCentral()
    }
}

subprojects {
    plugins.withId("org.jetbrains.kotlin.jvm") {
        dependencies {
            "testImplementation"(kotlin("test"))
        }
    }

    tasks.withType<Test>().configureEach {
        useJUnitPlatform()
    }
}
