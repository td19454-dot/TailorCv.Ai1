num = 404
lis = []
for i in range(num , num + 1000):
    root = int(i ** 0.5)
    if root * root == i:
        a = str(i)
        if a == a[::-1]:
            lis.append(i)
print(lis[0]-num)



num = 404
lis = []
while i > num:
    root = int(i ** 0.5)
    if root * root == i:
        a = str(i)
        if a == a[::-1]:
            lis.append(i)
    i -= 1
print(lis[-1]-num)



# modified version 
num = 404 
i = num + 1    
while True:
    root = int(i ** 0.5)
    if root * root == i:
        a = str(i)
        if a == a[::-1]:
            print(i - num)
            break
    i += 1
        


num1 = 4045
while num1 > 10 :
    sum = 0
    while num1 > 0:
        digit = num1 % 10
        sum += digit
        num1 = num1//10
    num1 = sum
    print(sum)
    
    
    
num2 = 34567 
while num2 > 10:
    sum = 0 
    while num2 > 0:
        digit = num2 % 10
        sum = sum + digit
        num2 = num2//10
    num2 = sum 
print(sum)
        
n = 7
d = 9
count  = 0
for i in range (1 , n+1):
       a = str(i*i)
       if int(a[-1]) == d :
         count = count + 1 
print(count)