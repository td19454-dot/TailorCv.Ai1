"Given an array of integers nums, perform the following transformation on each element based on its 0-based index i:"
"Subtract (i % 7) * 3 from nums[i]."
"If the original value of nums[i] is divisible by 11, add nums[i] / 11 to the modified value."
"After applying these transformations to all elements, return the total sum of all elements in the array."


nums = [22,5,14]
sum = 0
for i in range(len(nums)):
    val = nums[i]-(i%7)*3
    if nums[i]%11 == 0:
        val = val+nums[i]//11
    sum = sum + val
print(sum)



n = 50
a = []
for j in range(1,n):
    s = str(j)
    sum = 0 
    for i in range(1,len(s)+1):
         sum = sum + int(s[:i])
    if sum >= n :
        print(j)
        a.append(j)
print(len(a))


print("The numbers are: ")
y = 5
sum4 = 0
count = 0
for i in range(1 , y+1):
    sum4 =sum4 + i
    print(sum4)
    if sum4 % 5 == 0:
        count = count + 1
print("Count of numbers divisible by 5: ", count , "and the sum is: ", sum4)




# next code snippet
import math
s = "rrse"
z = math.sqrt(len(s))
grid = [[None] * int(z) for _ in range(int(z))]
for i in range(int(z)):
    for j in range(int(z)):
        grid[i][j] = s[i*int(z)+j]         
count = 0
for i in range(int(z)):
  if len(set(grid[i])) == 1:
        count += 1
# Check columns
for j in range(int(z)):
        column = []
        for i in range(int(z)):
            column.append(grid[i][j])
        if len(set(column)) == 1:
            count += 1
print("Count of rows and columns with identical characters: ", count)
    
    
    
    
    
#Write a function Productsmallpair(sum, arr) that takes an integer sum and an integer array arr.
#The function should:
#Find the two smallest elements in the array. Add these two elements together.If their sum is less than the given sum, return the product of the two elements.
#If no such pair exists, return 0. If the array is empty or contains fewer than 2 elements, return -1.
#Ensure that all values are within the valid integer range.


num1 = [5, 1, 3, 4, 2]
sum = 6
num1.sort()
if len(num1) < 2:
    print(-1)
else:
    k = num1[0] + num1[1]
    if k < sum:
        print(num1[0] * num1[1])
    else:
        print(0)


"Write a function differenceOfSum(n, m) that takes two positive integers n and m."
":The function should:"
"Find all integers from 1 to n (inclusive) that are not divisible by m and calculate their sum."
"Find all integers from 1 to n (inclusive) that are divisible by m and calculate their sum."
"Return the difference between these two sums:"

m = 2
n = 8
sum1 = 0
sum2 = 0
for i in range(1,n+1):
    if i % m != 0:
        sum1  = sum1 + i
    else:
        sum2 = sum2 + i
print("Difference of sums: ", sum1 - sum2)



#Write a function LargeSmallSum(arr).
#The function takes an integer array arr and should return the sum of:
#The second smallest element at an odd position in the array.
#The second largest element at an even position in the array.
#Assumptions
#Every array element is unique.
#The array is 0-indexed.
#Notes
#If the array is empty, return 0.
#If the array length is 3 or less, return 0.

array = [5, 1, 3, 4, 2]
if len(array) <= 3:
    print(0)
else:
    odd_array = [array[i] for i in range(len(array)) if i%2 != 0]
    even_array = [array[i] for i in range(len(array)) if i%2 == 0]  
odd_array.sort()
even_array.sort(reverse=True)
print("Sum of second smallest at odd position and second largest at even position: ", odd_array[1] + even_array[1])


"anargam"

sr1 = "riun"
sr2 = "nuri"
if sorted(sr1) == sorted(sr2):
    print("The strings are anagrams.")
else:
    print("The strings are not anagrams.")
    

    



     