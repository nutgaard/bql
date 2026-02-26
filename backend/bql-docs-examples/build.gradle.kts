plugins {
    kotlin("jvm")
    kotlin("plugin.serialization")
}

dependencies {
    implementation(project(":bql-compiler"))
    testImplementation(project(":bql-compiler"))
}
