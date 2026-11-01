{{- define "realm-keeper.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "realm-keeper.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/* Labels shared by every object. */}}
{{- define "realm-keeper.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: realm-keeper
{{- end }}

{{/*
Selector labels of a component; call with (dict "ctx" . "component" "backend").
Kept as the single `app` label the pre-Helm manifests used: a Deployment's
selector is immutable, so changing it would force deleting the Deployment.
*/}}
{{- define "realm-keeper.selectorLabels" -}}
app: {{ include "realm-keeper.fullname" .ctx }}-{{ .component }}
{{- end }}

{{/* Full label set of a component; same args as selectorLabels. */}}
{{- define "realm-keeper.componentLabels" -}}
{{ include "realm-keeper.selectorLabels" . }}
app.kubernetes.io/name: {{ include "realm-keeper.name" .ctx }}-{{ .component }}
app.kubernetes.io/component: {{ ternary "api" "web" (eq .component "backend") }}
{{ include "realm-keeper.labels" .ctx }}
{{- end }}

{{- define "realm-keeper.publicUrl" -}}
https://{{ .Values.host }}
{{- end }}
