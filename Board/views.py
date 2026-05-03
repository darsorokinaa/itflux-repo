from django.shortcuts import render

# Create your views here.
from django.shortcuts import render

def test_board(request):
    return render(request, "Board/test.html")
