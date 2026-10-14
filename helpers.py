import json


def loadf(file_name):
    return json.load(open(file_name, 'r'))

def writef(file_name, content):
    with open(file_name, 'w') as file:
        json.dump(content, file)