import re

with open('Generator/Generator/views.py', 'r') as f:
    content = f.read()

new_view = """
@csrf_exempt
@require_http_methods(["POST"])
def api_admin_upload(request):
    denied = _require_lesson_admin(request)
    if denied is not None:
        return denied

    upload_type = request.POST.get("type", "file")
    uploaded_file = request.FILES.get("file")
    
    if not uploaded_file:
        return JsonResponse({"error": "Файл не передан"}, status=400)

    try:
        if upload_type == "presentation":
            presentation = Presentation.objects.create(
                title=uploaded_file.name,
                original_file=uploaded_file
            )
            return JsonResponse({
                "id": presentation.id,
                "title": presentation.title,
                "type": "presentation"
            })
        else:
            file_resource = FileResource.objects.create(
                title=uploaded_file.name,
                file=uploaded_file,
                file_type=uploaded_file.name.split('.')[-1].lower() if '.' in uploaded_file.name else ""
            )
            return JsonResponse({
                "id": file_resource.id,
                "title": file_resource.title,
                "url": file_resource.file.url if file_resource.file else None,
                "type": "file"
            })
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)
"""

content += new_view

with open('Generator/Generator/views.py', 'w') as f:
    f.write(content)

